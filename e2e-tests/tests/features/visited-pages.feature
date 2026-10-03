
Feature: Visited Pages Tracking

Scenario: All visited pages start with allowed prefix

    This test ensures that during a browsing session, all visited pages belong to known, trusted domains.
    
    Backgrounds: int/web-server
    serve files at "/static" from "visited-pages"
    webserver is listening for "visited-pages"
    
    set of Allowed patterns as [string]
    compose localhost as Allowed patterns with {Web Server}/static/*
    
    compose page 1 with {Web Server}/static/page1.html
    go to the page 1 webpage
    wait for "Page 1"
    click "Go to Page 2"
    wait for "Page 2"
    click "Go to Page 3"
    wait for "Page 3"
    
    every page observed in visited pages is some pattern in Allowed patterns is matches {page} with {pattern}
    
    The feature also verifies that the browser didn't access an external domain.
    
    set of External patterns as [string]
    set external as External patterns to "https://external.com/*"
    
    not some page observed in visited pages is some pattern in External patterns is matches {page} with {pattern}

