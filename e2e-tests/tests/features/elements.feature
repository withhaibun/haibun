
Scenario: Elements
  Backgrounds: int/web-server
  serve files at "/static" from "elements"
  webserver is listening for "elements"
  compose elements page with {Web Server}/static/elements.html
  go to the elements page webpage

  set dialog as page-locator to [role="alertdialog"]
  in dialog, click "Hello"

Scenario: The window, its tabs and a picture of an element
  A feature moves focus away from an element, sizes the window, keeps a picture of one element, and works in a second tab before it returns to the first.
  blur dialog
  resize window to 800x600
  take a screenshot of dialog to "/tmp/haibun-elements-dialog.png"
  on a new tab
  go to the elements page webpage
  current tab is 1
  on tab 0
  current tab is 0
