Feature: Verify Monitor UI

Scenario: Test Mermaid graph controls
go to "file:///app/modules/web-playwright/web/monitor.html"
click the button "Code"
the selector "code" is visible
click the button "Rendered"
the selector "svg" is visible
click the button "+"
take a screenshot "verification.png"
