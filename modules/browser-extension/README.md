
Uses code from https://github.com/checkly/headless-recorder
Since this extension is injecting code into the user's browser, 
it is reduced to the bare minimum.

Selecting the extension button opens a popup with a play and stop button.
Pressing play injects a capture content script into the current tab.
The capture script sends browser events to a service 
that runs on port  on the local computer.
Pressing stop in the extension stops recording.

The extension uses the following permissions 
(in development; verify against manifest.json):

* cookies: log what cookies are managed in a tab
* activeTab: inject recording extension
* webNavigation: track navigation requests
* webRequest: log requests related to a tab
* scripting: 


## Notes

The worker won't unload as long as it has chrome.runtime ports open from any tab's content script or from another page of the extension. So the workaround is keep the port open for the duration of your extension's activity, be it a minute or a day. Currently the worker will reset such a connection each five minutes so you'll have to use the port's onDisconnect event to reconnect with some random tab again. - see Keepalive

The extension generates messages of JSON browser actions
A publisher publishes JsonCodeMessage to an endpoint
The endpoint receives messages with a JsonCodeMessage parser
The JsonCodeMessage parser translates the code to Haibun features




