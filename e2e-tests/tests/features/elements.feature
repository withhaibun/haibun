
Scenario: Elements
  serve files at /static from "elements"
  webserver is listening for "elements"
  go to the http://localhost:8123/static/elements.html webpage

  set dialog as page-locator to [role="alertdialog"]
  in dialog, click "Hello"
