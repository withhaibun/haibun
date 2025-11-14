Feature: Form-based Authentication

    Set Resource Server to http://localhost:8123
    Combine Resource Server and "/static/rest.html" to REST Home

    Start auth login route at /login

    Set OK to 200
    Set Unauthorized to 401

    Serve files at /static from "rest"
    Make auth scheme basic

    Scenario: Fail login with wrong credentials
        Go to the REST Home webpage
        Click username by placeholder
        type "wrong" 
        Click password by placeholder
        type "wrong"
        click "Login"
        See "Invalid credentials"

    Scenario: Pass login with correct credentials
        Go to the REST Home webpage
        Click username by placeholder
        type "foo"
        Click password by placeholder
        type "bar"
        click "Login"
        See "Login successful"
