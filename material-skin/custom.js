window._alarmDurationLoaded = true;
console.log('AlarmDuration custom.js loaded');

(function () {

    // --- Persistent state ---

    var _adPlayerId        = null;  // current player MAC, learned from intercepted requests
    var _adSaved           = {};    // alarmId → {duration, volume}, persisted in localStorage
    var _adTimeMap         = {};    // timeSecs (int) → alarmId, rebuilt from alarms list
    var _adPendingTimeSecs = null;  // time captured from pencil-click, used on next dialog open

    try { _adSaved = JSON.parse(localStorage.getItem('ad_saved') || '{}'); } catch (e) {}

    function persistSaved() {
        localStorage.setItem('ad_saved', JSON.stringify(_adSaved));
    }

    // --- Helpers ---

    function getInjectedValues() {
        var durationEl = document.getElementById('alarm-duration-mins');
        var volumeEl   = document.getElementById('alarm-volume-slider');
        return {
            duration: durationEl ? durationEl.value : null,
            volume:   volumeEl   ? volumeEl.value   : null,
        };
    }

    function saveToPlugin(playerId, alarmId, duration, volume) {
        if (!playerId || !alarmId) return;

        // Persist to localStorage so we can pre-populate edit dialogs later
        if (!_adSaved[alarmId]) _adSaved[alarmId] = {};
        if (duration) _adSaved[alarmId].duration = duration;
        if (volume !== null && volume !== undefined) _adSaved[alarmId].volume = volume;
        persistSaved();

        var url = '/plugins/AlarmDuration/settings/basic.html' +
                  '?player='        + encodeURIComponent(playerId) +
                  '&saveSettings=1' +
                  (duration ? '&duration_' + alarmId + '=' + encodeURIComponent(duration) : '') +
                  (volume !== null ? '&volume_' + alarmId + '=' + encodeURIComponent(volume) : '');

        origFetch(url, { method: 'GET' })
            .then(function ()   { console.log('AlarmDuration: saved successfully'); })
            .catch(function (e) { console.log('AlarmDuration: save error', e); });
    }

    // Sniff the player MAC from any outgoing request
    function capturePlayerId(bodyStr) {
        try {
            var parsed = JSON.parse(bodyStr);
            var id = parsed && parsed.params && parsed.params[0];
            if (id && typeof id === 'string' && /^[0-9a-f:]{17}$/i.test(id)) {
                if (!_adPlayerId) {
                    _adPlayerId = id;
                    syncFromPlugin(); // first time we know the player, pull saved values
                } else {
                    _adPlayerId = id;
                }
            }
        } catch (e) {}
    }

    // One-time sync: fetch the plugin settings page and parse saved duration/volume
    // into _adSaved so pre-population works even on first load after install.
    var _adSynced = false;
    function syncFromPlugin() {
        if (_adSynced || !_adPlayerId) return;
        _adSynced = true;

        origFetch('/plugins/AlarmDuration/settings/basic.html?player=' + encodeURIComponent(_adPlayerId))
            .then(function (r) { return r.text(); })
            .then(function (html) {
                var parser = new DOMParser();
                var doc    = parser.parseFromString(html, 'text/html');
                var inputs = doc.querySelectorAll('input[name^="duration_"], input[name^="volume_"]');
                inputs.forEach(function (input) {
                    var parts   = input.name.split('_');
                    var type    = parts[0];                      // "duration" or "volume"
                    var alarmId = parts.slice(1).join('_');     // rest is the alarm ID
                    if (!_adSaved[alarmId]) _adSaved[alarmId] = {};
                    if (input.value !== '' && input.value !== undefined) {
                        _adSaved[alarmId][type] = input.value;
                    }
                });
                persistSaved();
                console.log('AlarmDuration: synced from plugin', JSON.stringify(_adSaved));
            })
            .catch(function (e) {
                console.log('AlarmDuration: sync error', e);
                _adSynced = false; // allow retry
            });
    }

    // --- Click listener: capture alarm time when pencil icon is clicked ---
    // The edit dialog doesn't show the alarm time inside it, but the alarm list
    // row does. We walk up from the clicked element to find the nearest HH:MM text.
    document.addEventListener('click', function (e) {
        // Skip clicks inside our own injected fields — otherwise adjusting the
        // volume slider would re-trigger pre-population and reset the value.
        var el = e.target;
        var checkLimit = 8;
        while (el && checkLimit-- > 0) {
            if (el.className && el.className.toString().indexOf('alarm-duration-injected') !== -1) {
                return;
            }
            el = el.parentElement;
        }

        // Find the alarm label closest (by screen position) to the click.
        // The alarm time lives in a <label class="v-label"> — a sibling of the
        // pencil button, not an ancestor, so DOM walking won't find it.
        var labels = document.querySelectorAll('label.v-label');
        var bestLabel = null;
        var bestDist  = Infinity;
        var bestRect  = null;

        for (var i = 0; i < labels.length; i++) {
            var text = labels[i].textContent.trim();
            if (!/\d{1,2}:\d{2}/.test(text)) continue; // skip non-alarm labels

            var rect = labels[i].getBoundingClientRect();
            var cx   = rect.left + rect.width  / 2;
            var cy   = rect.top  + rect.height / 2;
            var dist = Math.abs(e.clientX - cx) + Math.abs(e.clientY - cy);

            if (dist < bestDist) {
                bestDist  = dist;
                bestLabel = labels[i];
                bestRect  = rect;
            }
        }

        if (bestLabel && bestRect) {
            // Only treat as a pencil click if the click is vertically on the same
            // row as the label. The pencil sits on the same row; "Add alarm" and
            // other buttons sit below all rows and will fail this check.
            var rowHeight  = Math.max(bestRect.height, 40);
            var labelCY    = bestRect.top + bestRect.height / 2;
            if (Math.abs(e.clientY - labelCY) > rowHeight * 2) {
                return; // too far vertically — not a pencil click
            }

            var match = bestLabel.textContent.trim().match(/([01]?\d|2[0-3]):([0-5]\d)/);
            if (match) {
                var secs = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60;
                _adPendingTimeSecs = secs;
                console.log('AlarmDuration: click near alarm ' + match[0] + ' (' + secs + 's)');
                setTimeout(populateFieldsIfEditing, 300);
                return;
            }
        }
    }, true);

    // --- Core alarm intercept logic ---

    function processAlarmBody(bodyStr, getResponseJson) {
        capturePlayerId(bodyStr);

        var parsed, params, playerId;
        try {
            parsed   = JSON.parse(bodyStr);
            params   = parsed && parsed.params && parsed.params[1];
            playerId = parsed && parsed.params && parsed.params[0];
        } catch (e) { return; }

        if (!params || params[0] !== 'alarm') return;

        var vals = getInjectedValues();

        if (params[1] === 'add') {
            if (!vals.duration && !vals.volume) return;
            getResponseJson().then(function (data) {
                var alarmId = data && data.result && data.result.id;
                if (!alarmId) return;
                console.log('AlarmDuration: add alarm ' + alarmId +
                            ' duration=' + vals.duration + ' volume=' + vals.volume);
                saveToPlugin(playerId, alarmId, vals.duration, vals.volume);
            }).catch(function (e) {
                console.log('AlarmDuration: response parse error', e);
            });
        }

        if (params[1] === 'update') {
            var alarmId = null;
            for (var i = 2; i < params.length; i++) {
                if (typeof params[i] === 'string' && params[i].indexOf('id:') === 0) {
                    alarmId = params[i].substring(3);
                    break;
                }
            }
            if (!alarmId || (!vals.duration && !vals.volume)) return;
            console.log('AlarmDuration: update alarm ' + alarmId +
                        ' duration=' + vals.duration + ' volume=' + vals.volume);
            saveToPlugin(playerId, alarmId, vals.duration, vals.volume);
        }
    }

    // --- Fetch interceptor ---

    var origFetch = window.fetch;
    window.fetch = function (url, options) {
        var result = origFetch.apply(this, arguments);
        try {
            if (options && options.body) {
                capturePlayerId(options.body);
                processAlarmBody(options.body, function () {
                    return result.then(function (r) { return r.clone().json(); });
                });
            }
        } catch (e) {
            console.log('AlarmDuration fetch intercept error:', e);
        }
        return result;
    };

    // --- XHR interceptor ---

    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
        this._adMethod = method;
        this._adUrl    = url;
        return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
        var xhr = this;
        if (body && typeof body === 'string') {
            try {
                capturePlayerId(body);
                var parsed = JSON.parse(body);
                var params = parsed && parsed.params && parsed.params[1];
                if (params && params[0] === 'alarm' &&
                    (params[1] === 'add' || params[1] === 'update')) {
                    processAlarmBody(body, function () {
                        return new Promise(function (resolve, reject) {
                            xhr.addEventListener('load', function () {
                                try { resolve(JSON.parse(xhr.responseText)); }
                                catch (e) { reject(e); }
                            });
                            xhr.addEventListener('error', reject);
                        });
                    });
                }
            } catch (e) {}
        }
        return origSend.apply(this, arguments);
    };

    // --- Edit dialog pre-population ---

    function populateFields(alarmId) {
        var saved = _adSaved[alarmId];
        if (!saved) {
            console.log('AlarmDuration: no saved data for alarm ' + alarmId);
            return;
        }

        console.log('AlarmDuration: pre-populating alarm ' + alarmId +
                    ' duration=' + saved.duration + ' volume=' + saved.volume);

        var durationEl = document.getElementById('alarm-duration-mins');
        var volumeEl   = document.getElementById('alarm-volume-slider');
        var labelEl    = document.getElementById('alarm-volume-label');

        if (durationEl && saved.duration !== undefined) {
            durationEl.value = saved.duration;
        }
        if (volumeEl && saved.volume !== undefined) {
            volumeEl.value = saved.volume;
            if (labelEl) labelEl.textContent = saved.volume + '%';
        }
    }

    function populateFieldsIfEditing() {
        // Use the time captured from the pencil click
        var timeSecs = _adPendingTimeSecs;
        _adPendingTimeSecs = null;

        if (timeSecs === null) {
            console.log('AlarmDuration: no pending time — new alarm, skipping pre-populate');
            return;
        }

        if (!_adPlayerId) {
            console.log('AlarmDuration: no player ID known yet, cannot pre-populate');
            return;
        }

        // Fetch the current alarms list to map time → alarmId
        origFetch('/jsonrpc.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: 1,
                method: 'slim.request',
                params: [_adPlayerId, ['alarms', 0, 100, 'filter:all']]
            })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            var loop = data && data.result && data.result.alarms_loop;
            if (!loop) return;

            _adTimeMap = {};
            loop.forEach(function (a) { _adTimeMap[parseInt(a.time)] = a.id; });

            var alarmId = _adTimeMap[timeSecs];
            if (!alarmId) {
                console.log('AlarmDuration: no alarm found at ' + timeSecs + 's');
                return;
            }

            populateFields(alarmId);
        })
        .catch(function (e) {
            console.log('AlarmDuration: error fetching alarms list', e);
        });
    }

    // --- Dialog field injection ---

    function findRepeatRow(dialog) {
        var items = dialog.querySelectorAll('div[role="listitem"]');
        for (var i = 0; i < items.length; i++) {
            var title = items[i].querySelector('.v-list__tile__title');
            if (title && title.textContent.trim() === 'Repeat') {
                return items[i];
            }
        }
        return null;
    }

    function injectFields(dialog) {
        if (dialog.querySelector('.alarm-duration-injected')) return;

        var repeatRow = findRepeatRow(dialog);
        if (!repeatRow) return;

        var container = document.createElement('div');
        container.className     = 'alarm-duration-injected';
        container.style.cssText = 'padding: 8px 16px;';
        container.innerHTML = [
            '<div style="margin-bottom:12px;">',
            '  <label style="color:var(--text-color);font-size:14px;display:block;margin-bottom:4px;">Duration (mins)</label>',
            '  <input type="number" id="alarm-duration-mins" min="0" max="480" placeholder="e.g. 60"',
            '         style="width:100px;padding:4px 8px;background:var(--bottom-toolbar-border-color);',
            '                color:var(--text-color);border:1px solid var(--accent-color);border-radius:4px;">',
            '</div>',
            '<div>',
            '  <label style="color:var(--text-color);font-size:14px;display:block;margin-bottom:4px;">',
            '    Volume: <span id="alarm-volume-label">50%</span>',
            '  </label>',
            '  <input type="range" id="alarm-volume-slider" min="0" max="100" step="5" value="50"',
            '         style="width:200px;accent-color:var(--accent-color);"',
            '         oninput="document.getElementById(\'alarm-volume-label\').textContent=this.value+\'%\'">',
            '</div>',
        ].join('');

        repeatRow.parentNode.insertBefore(container, repeatRow.nextSibling);
    }

    var observer = new MutationObserver(function (mutations) {
        for (var m = 0; m < mutations.length; m++) {
            var added = mutations[m].addedNodes;
            for (var n = 0; n < added.length; n++) {
                var node = added[n];
                if (node.nodeType !== 1 || !node.querySelector) continue;
                if (!node.querySelector('div[role="listitem"]')) continue;
                var titles = node.querySelectorAll('.v-list__tile__title');
                for (var t = 0; t < titles.length; t++) {
                    if (titles[t].textContent.trim() === 'Repeat') {
                        (function (n) { setTimeout(function () { injectFields(n); }, 100); })(node);
                        break;
                    }
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();
