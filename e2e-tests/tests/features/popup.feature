
Scenario: Handle popup window

    Backgrounds: int/popup

    serve files from "popup"
    Go to the test webpage
    click "Open popup"

;; FIXME for some reason this passes when only this test is run, in which case current tab is 2.
    until current tab is 4
    on tab 2
    be on the popped up webpage
    see "Congratulations"

