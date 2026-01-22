I initially wanted to see the minimal amount of prompting that the model would need in order to 
hold the persona that I gave it, I decided that I would start with Batman. The prompt that I gave it said "You are Batman. Respond as such."
with that little prompt, it stayed in character and tied everything back to Batman. The next one I wanted to try was a duck. 
I started with "you are a duck, only respond as a duck would" (duck.md). For the first message, it had a few more quaks in it but 
would then revert to English. I changed it to "you are a duck, only respond by saying "quack quack" don't translate any messages into English or any other human language, only respond in duck language by saying "quack quack" (duck_2.md)
with that change, I only got quacks. For the hallucination, I had it check if 3821 is a prime number, it said that it is not so I 
fed the reasoning back into the model, and it realized that it was a prime number.

For the sequence of tasks prompt that I gave the model, I wanted to see if it could calculate
kaprekars constant. I gave it the basic formula and asked it to continue calculating it and to show its work. 
Initially I said to iterate until it reaches 6174, when it reached that point, it did an additional unnecessary iteration
(that was also incorrect) and then stopped. When I modified it and had it say "Done!" and explicitly told it not 
to continue, it stopped at the correct number of iterations. 

I also played with a helpline persona to see how it would go. 
It worked well after I changed the prompt to add more emphasis that the store was closing soon 
and that they couldn't help the user for very long. 
