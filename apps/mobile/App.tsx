import React from 'react';
import { StyleSheet, Text, View, StatusBar } from 'react-native';
import { BadmintonRules } from '@arena-flow/sport-engine';

export default function App() {
  const rules = new BadmintonRules();
  const state = rules.getInitialState();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ArenaFlow Mobile Scorer</Text>
      <Text style={styles.subtitle}>Run tournaments. Track every point.</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Domain Logic Verification</Text>
        <Text style={styles.cardText}>Active Sport: {rules.sportId}</Text>
        <Text style={styles.cardText}>Games count: {state.games.length}</Text>
        <Text style={styles.cardText}>Current Game Index: {state.currentGameIndex}</Text>
      </View>

      <Text style={styles.footer}>Phase 0 Native Console</Text>
      <StatusBar barStyle="light-content" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0f12',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#3b82f6',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 30,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 15,
    width: '100%',
    maxWidth: 320,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  cardText: {
    fontSize: 14,
    color: '#a0aec0',
    marginBottom: 5,
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    fontSize: 10,
    color: '#555',
  },
});
