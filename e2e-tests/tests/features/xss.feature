
Scenario: Check against URI xss exploit

    Backgrounds: int/web-server, service/xss

    serve files from "xss"
    webserver is listening for "xss"
    accept next dialog to "clicked"
    go to the xss webpage
    not variable clicked.message exists

    compose exploit with {xss}?;alert('hi')
    go to the exploit webpage
    The exploit webpage opens a dialog. The `accept next dialog` step accepts each dialog the page opens. This feature doesn't check the message of that dialog.
    ;; variable clicked.message is "hi"