
Scenario: After-every

Tests accessibility after browser action.

using timeout of 1000ms
Backgrounds: service/counter, int/counter
    serve files at /static from "counter"
    set username to 10 random characters

    start tally route at /count
    using timeout of 2000ms
    
    After every WebPlaywright, Page is accessible accepting serious 9 and moderate 9
    Go to the counter webpage
    input username for user name
    click Submit

    URI query parameter username is username
    save URI query parameter username to username parameter
    URI starts with counter URI
    should see username
    cookie userid is username
