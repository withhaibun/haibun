Feature: Mobile Login Flow

Backgrounds: login-elements

This feature demonstrates all mobile domain types (mobile-testid, mobile-accessibility, mobile-xpath, string)
for testing a React Native mobile application.

Scenario: Successful login with mobile-testid domain

# mobile-testid domains are used for elements with testID props
wait for Submit Button
see Login Title
tap Username Input
input "testuser" in Username Input
tap Password Input
input "password123" in Password Input
tap Submit Button
wait for Welcome Message
see Welcome Message
in Welcome Message, see "Welcome, testuser!"

Scenario: Failed login using mobile-accessibility domain

# mobile-accessibility domain is used for elements with accessibilityLabel props
see Login Title
tap Username Field
input "wronguser" in Username Field
tap Password Field
input "wrongpass" in Password Field
tap Login Button
wait for Error Text
see Error Text
in Error Text, see "Invalid credentials"

Scenario: Verify using mixed domains

# Demonstrating mobile-xpath, testID, and string domains together
see Login Title
see Username Label
tap Username Input
input "testuser" in Username Input
tap Password Input
input "password123" in Password Input
tap Login Button Text
wait for Welcome Text
see Welcome Text
