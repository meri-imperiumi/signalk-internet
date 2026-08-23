# Internet Connectivity Monitor for Signal K

This plugin serves as an internet connectivity monitor for Signal K. Many Signal K plugins interact with internet-based services, and this plugin provides the necessary deltas for them to know if the boat is connected or not.

* `network.internet.state`: `online`, `offline`, `metered`
* `network.internet.pink`: round-trip ping time to a verification endpoint

In addition to its own detection logic, the plugin can read status from uplink-specific provider plugins. Examples:

* signalk-starlink sets `network.providers.starlink.status` to `online` when Starlink is connected
* signalk-teltonika-rutx provides operator name in `networking.lte.connectionText`. You can set different operators as `online` or `metered`
