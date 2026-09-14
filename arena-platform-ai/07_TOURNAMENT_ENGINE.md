# Tournament Engine

Support V1:
1. Knockout
2. Round robin
3. Group stage → knockout

## Knockout
Represent bracket as nodes and relationships, not hard-coded UI arrays.

For N participants:
- determine bracket size
- seed/byes
- generate rounds and matches
- advance winners automatically
- handle byes
- prevent invalid duplicate advancement

## Round robin
Generate every unique pairing exactly once within a group.
For n participants, matches per group = n(n-1)/2.

## Group + knockout
- create groups
- generate group fixtures
- calculate standings
- qualify configurable top N
- generate knockout bracket from qualifiers

## Seeding
V1:
- random
- manual

Future:
- ranking-based
- club/college separation

## Tiebreaking
Make the ordering configurable rather than hard-coding a single universal rule.
Potential rules include wins, game difference, point difference, head-to-head.
