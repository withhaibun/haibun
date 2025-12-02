Feature: Form-based Authentication

    set Resource Server to http://localhost:8123
    combine Resource Server and "/static/rest.html" to REST Home

    start auth login route at /login

    set OK to 200
    set Unauthorized to 401

    serve files at /static from "rest"
    make auth scheme basic

    Scenario: Fail login with wrong credentials
        go to the REST Home webpage
        click username by placeholder
        type "wrong" 
        click password by placeholder
        type "wrong"
        click "Login"
        see "Invalid credentials"

    Scenario: Pass login with correct credentials
        go to the REST Home webpage
        click username by placeholder
        type "foo"
        click password by placeholder
        type "bar"
        click "Login"
        see "Login successful"
