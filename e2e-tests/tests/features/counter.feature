
Scenario: A form and counter
    Backgrounds: service/counter, int/counter

    This should pause eh.
    This scenario is written twice, here and as counter.feature.ts, so the two ways of writing a feature are shown to describe one run. Neither copy is redundant: together they are the only proof that gherkin and kireji say the same thing.
    set username to 10 random characters

    Then serve files at /static from "counter"
    webserver is listening for "counter"
    And start tally route at /count
    
    go to the counter webpage

    When I enter username into user name
    And I click Submit

    Then the URI query parameter "username" is username
    Then save URI query parameter "username" to "username parameter"
    Then matches WebPlaywright.currentURI with "{counter URI}*"
    And I should see username
    And the cookie "userid" is username

