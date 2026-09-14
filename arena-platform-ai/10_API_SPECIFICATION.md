# API Specification

Prefer typed application services/server functions with Zod validation.

## Auth
- get current profile
- update profile

## Tournaments
GET /tournaments
POST /tournaments
GET /tournaments/:id
PATCH /tournaments/:id
POST /tournaments/:id/publish

## Categories
GET /tournaments/:id/categories
POST /tournaments/:id/categories
PATCH /categories/:id

## Participants
GET /categories/:id/participants
POST /categories/:id/participants
PATCH /participants/:id

## Draw
POST /categories/:id/draw/generate
GET /categories/:id/draw

## Matches
GET /matches/:id
POST /matches/:id/start
POST /matches/:id/pause
POST /matches/:id/resume
POST /matches/:id/finalize

## Scoring
POST /matches/:id/events
POST /matches/:id/undo

## Public
GET /public/tournaments/:slug
GET /public/tournaments/:slug/matches
GET /public/matches/:id

Every mutation must validate:
- authenticated identity
- role/ownership
- entity state
- payload schema
- business rules
