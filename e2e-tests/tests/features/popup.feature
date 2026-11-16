
Scenario: Handle popup window

    Backgrounds: int/web-server, int/popup

    serve files from "popup"
    webserver is listening for "popup"
    go to the test webpage
    click "Open popup"

    until matches BrowserPage:1.uri with "*poppedup*" within "5s"
    see "Congratulations"

