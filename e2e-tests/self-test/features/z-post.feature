This is used to force Playwright to emit the video from the main test when using STAY=always, since it only does so when a feature is finished and the browser is closed.

Scenario: Verify secrets are not leaked in the saved HTML report.
The MonitorBrowser stepper saved a report to a known path.
set report to "/tmp/self-test-report.html"
storage entry report exists

The HTML report must not contain any of the secret values that were set.
not text at report contains "my-secret-password"
not text at report contains "key-123-abc"
not text at report contains "db-secret-pass"
not text at report contains "session-abc-123"
not text at report contains "token-xyz"
not text at report contains "admin-secret"
not text at report contains "all-caps-pass"
not text at report contains "camel-case-pass"
not text at report contains "snake-case-pass"
not text at report contains "secret-value-123"

The report should contain the hidden placeholder instead.
text at report contains "[hidden secret]"

