Scenario: Test accessibility pass

Backgrounds: int/a11y

Files for accessibility checks are served for the automated testing process.

Serve files from "a11y"

Go to the test webpage
click "description" by placeholder

The test navigates to the webpage, where the automated accessibility evaluation will take place.

Page is accessible accepting serious 9 and moderate 9

The settings allow for this number of issues without failing the test. The test should pass because the axe tool identified nine or fewer serious accessibility issues.

This threshold ensures that while some accessibility issues may be present, they are within an acceptable limit.