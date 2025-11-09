
Scenario: A form and counter
    Backgrounds: service/counter, int/counter

    This should pause eh.
    set username to 10 random characters

    Then serve files at /static from "counter"
    And start tally route at /count
    
    Go to the counter webpage

    When I input username for user name
    And I click Submit

    Then the URI query parameter username is username
    Then save URI query parameter username to username parameter
    Then the URI starts with counter URI
    And I should see username
    And the cookie userid is username
