Feature: Mobile Login Flow

Backgrounds: login-elements

This feature demonstrates all mobile domain types (mobile-testid, mobile-xpath, string) 
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

Scenario: Failed login using mixed domains

# Demonstrating mobile-xpath and mobile-testid together
see Login Title
see Username Label
tap Username Input
input "wronguser" in Username Input
tap Password Input
input "wrongpass" in Password Input
tap Submit Button
wait for Error Message
see Error Message
in Error Message, see "Invalid credentials"

Scenario: Verify button text using string domain

# String domain as fallback for text matching
see Login Button Text
tap Username Input
input "testuser" in Username Input
tap Password Input  
input "password123" in Password Input
tap Login Button Text
wait for Welcome Message
see Welcome Message
