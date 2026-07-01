package Plugins::AlarmDuration::Settings;

use strict;
use base qw(Slim::Web::Settings);

use Slim::Utils::Prefs;
use Slim::Utils::Alarm;
use Plugins::AlarmDuration::Plugin;

my $prefs = preferences('plugin.alarmduration');

sub name {
    return Slim::Web::HTTP::CSRF->protectName('PLUGIN_ALARMDURATION');
}

sub page {
    return Slim::Web::HTTP::CSRF->protectURI('plugins/AlarmDuration/settings/basic.html');
}

sub handler {
    my ($class, $client, $params, $callback, $httpClient, $response) = @_;

    my @alarms = Slim::Utils::Alarm->getAlarms($client);

    # Handle form submission
    if ($params->{saveSettings}) {
        for my $alarm (@alarms) {
            my $id = $alarm->id();

            my $minutes = $params->{"duration_$id"};
            if (defined $minutes && $minutes =~ /^\d+$/ && $minutes > 0) {
                Plugins::AlarmDuration::Plugin::setAlarmDuration(
                    $client, $id, $minutes * 60
                );
            } elsif (defined $minutes && $minutes eq '0') {
                Plugins::AlarmDuration::Plugin::removeAlarmDuration(
                    $client, $id
                );
            }

            my $volume = $params->{"volume_$id"};
            if (defined $volume && $volume =~ /^\d+$/ && $volume <= 100) {
                Plugins::AlarmDuration::Plugin::setAlarmVolume(
                    $client, $id, $volume
                );
            }
        }
    }

    # Build template data
    my @alarmData;
    my @dayNames = qw(Sun Mon Tue Wed Thu Fri Sat);

    for my $alarm (@alarms) {
        my $id      = $alarm->id();
        my $rawSecs = Plugins::AlarmDuration::Plugin::getAlarmDuration($client, $id);
        my $volume  = Plugins::AlarmDuration::Plugin::getAlarmVolume($client, $id);

        my $timeSecs = $alarm->time();
        my $hours    = int($timeSecs / 3600);
        my $mins     = int(($timeSecs % 3600) / 60);
        my $timeStr  = sprintf("%02d:%02d", $hours, $mins);

        my @activeDays;
        for my $i (0..6) {
            push @activeDays, $dayNames[$i] if $alarm->day($i);
        }
        my $daysStr = @activeDays ? join(', ', @activeDays) : 'Every day';

        push @alarmData, {
            id       => $id,
            time     => $timeStr,
            days     => $daysStr,
            enabled  => $alarm->enabled(),
            duration => defined $rawSecs ? int($rawSecs / 60) : '',
            volume   => defined $volume  ? $volume : 50,
        };
    }

    $params->{alarms}     = \@alarmData;
    $params->{playerName} = $client->name();

    return $class->SUPER::handler($client, $params, $callback, $httpClient, $response);
}

1;
