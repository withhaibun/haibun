
Scenario: Check against URI xss exploit

    Backgrounds: service/xss

    serve files from "xss"
    accept next dialog to clicked
    go to the xss webpage
    pause for 1s
    dialog "clicked" message not set

    combine xss and ?;alert('hi') to exploit
    go to the exploit webpage
    pause for 1s
    Playwright auto accepts dialogs, so we cannot check this.
    ;; dialog "clicked" message says "hi"