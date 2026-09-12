Tennis Score Calculator — Problem Statement

Write a function that calculates the score of a tennis game.

The function receives an array containing the player who won each point. The players are represented by "A" and "B".

For example:

["A", "A", "B", "B", "A", "B", "A", "A"]

The function should process the points in order and return the current/final score of the game according to standard tennis scoring rules.

The solution must correctly handle:

0
15
30
40
Deuce
Advantage A
Advantage B
A wins
B wins

A player must win by two points after reaching deuce.

Expected examples
tennisScore(["A"]);
// "15 - 0"

tennisScore(["A", "A"]);
// "30 - 0"

tennisScore(["A", "A", "A"]);
// "A Wins"

tennisScore(["A", "A", "A", "B", "B", "B"]);
// "Deuce"

tennisScore(["A", "A", "A", "B", "B", "B", "A"]);
// "Advantage A"

tennisScore(["A", "A", "A", "B", "B", "B", "A", "A"]);
// "A Wins"
Important rule

After deuce:

Deuce
  ↓
A wins point
  ↓
Advantage A
  ↓
A wins point
  ↓
A Wins

But:

Deuce
  ↓
A wins point
  ↓
Advantage A
  ↓
B wins point
  ↓
Deuce

And similarly for B.

What the interviewer is really testing

The interesting part isn't calculating 15 → 30 → 40. It's whether your implementation correctly models the state transitions after 40–40.

You should also be prepared for follow-ups such as:

"What happens if A and B keep alternating points after deuce?"

"What if the input is empty?"

"What is the time and space complexity?"

"Can you simplify/refactor your implementation?"

"Can you return the score after every point instead of only the final score?"

One caveat: I would not call the exact wording above an official Veeam-provided statement. The Tennis Score Calculator is reported by candidates/interview write-ups; the exact examples and return-string formatting can vary between versions of the question. The core requirement—processing a sequence of point winners and correctly handling deuce/advantage—is the part you should prepare against.





console.log(tennisScore(["A", "A", "A", "B", "B", "B", "A", "A"]));
// "A Wins"

console.log(tennisScore(["A", "A", "A", "B", "B", "B", "A"]));
// "Advantage A"

console.log(tennisScore(["A", "A", "A", "B", "B", "B"]));
// "Deuce"

console.log(tennisScore(["A", "A", "B", "A"]));
// "Game in progress"

console.log(tennisScore(["A", "A", "B", "B", "B", "B"]));
// "B Wins"

console.log(tennisScore(["A"]));
// "Game in progress"

function tennisScore(points) {
       let A = [0]
       let B = [0]
  
    
    for(let i = 0; i < points.length; i++){
      if(points[i]==="A"){
       let currScore = (A?.[A.length - 1] || 0) +  15;
        A.push(currScore)    
      }
      if(points[i]==="B"){
       let currScoreB = (B?.[B.length - 1] || 0) +  15;
        B.push(currScoreB)    
      }
    }
  console.log(A);
 console.log(B);
  
    if(A.length >=5 || B.length >=5){
      if(A.length - B.length >= 2){
        return 'A Wins'
      }
       if(B.length - A.length >= 2){
        return 'B Wins'
      }
    }
     if(A.length >=4 || B.length >=4){
        if(A.length === B.length ){
           return 'Duece'
        }
       if(A.length - B.length === 1 ){
           return 'A Advantage'
        }
       if(B.length - A.length === 1 ){
           return 'B Advantage'
        }
      }
     
    return "Game in progress";
}