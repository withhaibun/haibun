
Scenario: Elements
  Backgrounds: int/web-server
  serve files at "/static" from "elements"
  webserver is listening for "elements"
  compose elements page with {Web Server}/static/elements.html
  go to the elements page webpage

  set dialog as page-locator to [role="alertdialog"]
  in dialog, click "Hello"

Scenario: The window, its size, a picture of an element, and a second tab
  A feature moves focus away from an element, sizes the window, keeps a picture of one element, and opens a second tab whose page it reads by its tab.
  blur dialog
  resize window to 800x600
  take a screenshot of dialog to "/tmp/haibun-elements-dialog.png"
  on a new tab
  go to the elements page webpage
  matches BrowserPage:0.uri with "*elements.html*"
