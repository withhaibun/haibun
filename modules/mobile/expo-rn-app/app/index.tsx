import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

export default function Index() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  const handleLogin = () => {
    console.log('Login attempt:', { username, password, usernameLength: username.length, passwordLength: password.length });
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();
    if (trimmedUsername === 'testuser' && trimmedPassword === 'password123') {
      setMessage('Welcome, testuser!');
      setIsError(false);
    } else {
      setMessage(`Invalid credentials`);
      setIsError(true);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Login</Text>

      <TextInput
        style={styles.input}
        placeholder="Username"
        value={username}
        onChangeText={setUsername}
        testID="usernameInput"
        accessibilityLabel="usernameField"
        autoCapitalize="none"
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        testID="passwordInput"
        accessibilityLabel="passwordField"
        secureTextEntry
        autoCapitalize="none"
      />

      <TouchableOpacity
        style={styles.button}
        onPress={handleLogin}
        testID="submitButton"
        accessibilityLabel="loginButton">
        <Text style={styles.buttonText}>Login</Text>
      </TouchableOpacity>

      {message ? (
        <Text
          style={[styles.message, isError && styles.errorMessage]}
          testID={isError ? 'errorMessage' : 'welcomeMessage'}
          accessibilityLabel={isError ? 'errorText' : 'welcomeText'}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  message: {
    marginTop: 20,
    fontSize: 16,
    textAlign: 'center',
    color: 'green',
  },
  errorMessage: {
    color: 'red',
  },
});
