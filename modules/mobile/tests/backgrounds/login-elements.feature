# Using mobile-testid domain (prepends ~ for accessibility ID - maps to testID)
set Username Input as mobile-testid to usernameInput
set Password Input as mobile-testid to passwordInput
set Submit Button as mobile-testid to submitButton
set Welcome Message as mobile-testid to welcomeMessage
set Error Message as mobile-testid to errorMessage

# Using mobile-accessibility domain (prepends ~ for accessibility ID - maps to accessibilityLabel)
set Username Field as mobile-accessibility to usernameField
set Password Field as mobile-accessibility to passwordField
set Login Button as mobile-accessibility to loginButton
set Welcome Text as mobile-accessibility to welcomeText
set Error Text as mobile-accessibility to errorText

# Using mobile-xpath domain (raw XPath expression)
set Login Title as mobile-xpath to //android.widget.TextView[@text='Login']
set Username Label as mobile-xpath to //android.widget.EditText[@content-desc='usernameField']

# Using regular string domain (fallback for simple text matching)
set Login Button Text to Login
