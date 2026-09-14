# Badminton Scoring Engine

V1 rules:
- Best of 3 games.
- Rally point scoring.
- Game target 21.
- At 20–20, a player must lead by 2.
- At 29–29, the next point wins at 30.
- Match ends when one side wins 2 games.

## Domain operations
startMatch()
startGame()
addPoint(participantId)
undoLastPoint()
getCurrentScore()
isGameComplete()
finishGame()
isMatchComplete()
finishMatch()

## State
Match:
- current game
- games won by each participant
- status

Game:
- score A/B
- event sequence
- status

## Important
Scoring logic belongs in a shared package. Web and mobile must not duplicate it.

## Required tests
- 0–0
- 20–18 then A point => 21–18 game
- 20–20 then A point => 21–20, game continues
- 21–20 then A point => 22–20, game ends
- 29–29 then A point => 30–29, game ends
- best of 3 ending 2–0
- best of 3 ending 2–1
- undo last point
- invalid scoring after game/match final
- unauthorized scorer
- duplicate event submission
