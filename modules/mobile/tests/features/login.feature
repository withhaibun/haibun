Feature: Login Flow

Backgrounds: login-elements

This feature tests the login flow of a React Native mobile application.

Scenario: Successful login

Wait for Login Button
Tap on Username Input
Type "testuser" in Username Input
Tap on Password Input
Type "password123" in Password Input
Hide keyboard
Tap on Submit Button
Wait for Welcome Message
See Welcome Message

Scenario: Failed login

Wait for Login Button
Tap on Username Input
Type "wronguser" in Username Input
Tap on Password Input
Type "wrongpass" in Password Input
Tap on Submit Button
Wait for Error Message
See Error Message
