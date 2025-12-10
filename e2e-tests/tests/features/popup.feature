
Scenario: Handle popup window

    Backgrounds: int/popup

    serve files from "popup"
    go to the test webpage
    click "Open popup"

    until current tab is 2
    be on the popped up webpage
    see "Congratulations"

