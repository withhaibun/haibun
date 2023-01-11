Backgrounds: extension, services

This test will open some Chrome extension debugging pages, then open a test page. 
It will open the extension popup window in a new tab, and click its Record button.
Then it will switch to a test page, where the operator can record tests.

On the chrome://extensions/ webpage

On a new tab
On the http://localhost:8123/form.html webpage

On a new tab
On the inspect extensions webpage

On a new tab
open extension popup for tab 2

Click the button record

on tab 3
in record, should see `stop`

click the button record
in record, should see `play`