
Feature: Visited Pages Tracking

Scenario: All visited pages start with allowed prefix

    This test ensures that during a browsing session, all visited pages belong to known, trusted domains.
    
    serve files at /static from "visited-pages"
    
    set of Allowed prefixes as [string]
    set localhost as Allowed prefixes to "http://localhost:8123/static/"
    
    go to the http://localhost:8123/static/page1.html webpage
    wait for "Page 1"
    click "Go to Page 2"
    wait for "Page 2"
    click "Go to Page 3"
    wait for "Page 3"
    
    every page in Visited pages is some prefix in Allowed prefixes is that {page} starts with {prefix}
    
    We also verify that no external domains were accessed.
    
    set of External prefixes as [string]
    set external as External prefixes to "https://external.com/"
    
    not some page in Visited pages is some prefix in External prefixes is that {page} starts with {prefix}
