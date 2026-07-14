package Plugins::AlarmDuration::Plugin;

use strict;
use base qw(Slim::Plugin::Base);

use Slim::Utils::Log;
use Slim::Utils::Prefs;
use Slim::Utils::Alarm;
use Slim::Utils::Timers;
use Plugins::AlarmDuration::Settings;

my $log = Slim::Utils::Log->addLogCategory({
    'category'     => 'plugin.alarmduration',
    'defaultLevel' => 'INFO',
});

my $prefs = preferences('plugin.alarmduration');

sub initPlugin {
    my $class = shift;
    $class->SUPER::initPlugin(@_);
    Plugins::AlarmDuration::Settings->new();

    # Hook into alarm firing
    Slim::Control::Request::subscribe(
        \&alarmFired,
        [['alarm'], ['sound']]
    );

    # Hook into player powering off to restore volume
    Slim::Control::Request::subscribe(
        \&playerSleeping,
        [['power'], ['0']]
    );

    $log->info("AlarmDuration: plugin initialised.");
}

sub alarmFired {
    my $request = shift;
    my $client  = $request->client() or return;

    my $alarm = Slim::Utils::Alarm->getCurrentAlarm($client);
    return unless $alarm;

    my $alarmId     = $alarm->id();
    my $playerPrefs = $prefs->client($client);
    my $durations   = $playerPrefs->get('alarm_durations') || {};
    my $volumes     = $playerPrefs->get('alarm_volumes')   || {};

    # Apply per-alarm volume
    my $volume = $volumes->{$alarmId};
    if (defined $volume) {
        $log->info("AlarmDuration: alarm $alarmId - setting volume to $volume");

        unless (defined $playerPrefs->get('pre_alarm_volume')) {
            $playerPrefs->set('pre_alarm_volume', $client->volume());
        }

        Slim::Control::Request::executeRequest(
            $client,
            ['mixer', 'volume', $volume]
        );
    }

    # Apply per-alarm sleep duration via a direct timer — immune to stream reconnects
    # resetting the sleep command (BBC Sounds reconnects hourly and would clear it)
    my $duration = $durations->{$alarmId};
    if (defined $duration && $duration > 0) {
        $log->info("AlarmDuration: alarm $alarmId - scheduling power off in $duration seconds");

        Slim::Utils::Timers::killTimers($client, \&_powerOffPlayer);
        Slim::Utils::Timers::setTimer($client, Time::HiRes::time() + $duration, \&_powerOffPlayer);
    }
}

sub _powerOffPlayer {
    my $client = shift;
    $log->info("AlarmDuration: alarm duration elapsed - powering off player");
    Slim::Control::Request::executeRequest($client, ['pause', '1']);
    Slim::Control::Request::executeRequest($client, ['power', '0']);
}

sub playerSleeping {
    my $request = shift;
    my $client  = $request->client() or return;

    my $playerPrefs    = $prefs->client($client);
    my $preAlarmVolume = $playerPrefs->get('pre_alarm_volume');

    if (defined $preAlarmVolume) {
        $log->info("AlarmDuration: restoring pre-alarm volume to $preAlarmVolume");

        Slim::Control::Request::executeRequest(
            $client,
            ['mixer', 'volume', $preAlarmVolume]
        );

        $playerPrefs->remove('pre_alarm_volume');
    }
}

# --- Helpers ---

sub setAlarmDuration {
    my ($client, $alarmId, $seconds) = @_;
    my $playerPrefs = $prefs->client($client);
    my $durations   = $playerPrefs->get('alarm_durations') || {};
    $durations->{$alarmId} = $seconds;
    $playerPrefs->set('alarm_durations', $durations);
}

sub getAlarmDuration {
    my ($client, $alarmId) = @_;
    my $playerPrefs = $prefs->client($client);
    my $durations   = $playerPrefs->get('alarm_durations') || {};
    return $durations->{$alarmId};
}

sub removeAlarmDuration {
    my ($client, $alarmId) = @_;
    my $playerPrefs = $prefs->client($client);
    my $durations   = $playerPrefs->get('alarm_durations') || {};
    delete $durations->{$alarmId};
    $playerPrefs->set('alarm_durations', $durations);
}

sub setAlarmVolume {
    my ($client, $alarmId, $volume) = @_;
    my $playerPrefs = $prefs->client($client);
    my $volumes     = $playerPrefs->get('alarm_volumes') || {};
    $volumes->{$alarmId} = $volume;
    $playerPrefs->set('alarm_volumes', $volumes);
}

sub getAlarmVolume {
    my ($client, $alarmId) = @_;
    my $playerPrefs = $prefs->client($client);
    my $volumes     = $playerPrefs->get('alarm_volumes') || {};
    return $volumes->{$alarmId};
}

sub removeAlarmVolume {
    my ($client, $alarmId) = @_;
    my $playerPrefs = $prefs->client($client);
    my $volumes     = $playerPrefs->get('alarm_volumes') || {};
    delete $volumes->{$alarmId};
    $playerPrefs->set('alarm_volumes', $volumes);
}

sub getDisplayName { return 'PLUGIN_ALARMDURATION' }

1;
