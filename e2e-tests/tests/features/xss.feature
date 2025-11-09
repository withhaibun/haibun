
Scenario: Check against URI xss exploit

    Backgrounds: service/xss

    Serve files from "xss"
    Accept next dialog to clicked
    go to the xss webpage
    pause for 1s
    Dialog "clicked" message not set

    Combine xss and ?;alert('hi') to exploit
    Go to the exploit webpage
    pause for 1s
    Playwright auto accepts dialogs, so we cannot check this.
    ;; Dialog "clicked" message says "hi"