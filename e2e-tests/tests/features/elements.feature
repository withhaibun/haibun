
Scenario: Elements
  Backgrounds: int/web-server
  serve files at "/static" from "elements"
  webserver is listening for "elements"
  compose elements page with {Web Server}/static/elements.html
  go to the elements page webpage

  set dialog as page-locator to [role="alertdialog"]
  in dialog, click "Hello"
