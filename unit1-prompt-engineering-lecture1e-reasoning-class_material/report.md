For my investigation into reasoning, I decided to ask each of the models the same question
and then compare the results while also checking to see the differences in token usage and the overall price. The 
models that I used were 4o, 4o-mini, 5, 5-nano and 5-mini. The questions that 
I asked were 

_what is the meaning to life the universe and everything_ 

_make this sentence better. "I am batman"_ 

_solve this math equation. (e^(2ix) + e^(-2ix) )/4 + e^(2ln(sin(x))) + 1/2_

this prompt was to see if the models could reason through the equation (it simplfies to 1) without 
reasoning and if reasoning was actually needed. All models gave the correct answer of 1.


I also prompted

_You are at your best friend's wedding just an hour before the ceremony is to start. Earlier that day, you came across definitive proof that your best friend's spouse-to-be is having an affair with the best man/maid of honor, and you catch them sneaking out of a room together looking disheveled. If you tell your friend about the affair, their day 
will be ruined, but you don't want them to marry a cheater. What do you do?_

I wanted to see how each model would perform with different kinds of questions and 
the reasoning for each response. The conclusion  
that I came to was that for the most part with these simple the reasoning seemed redundant and for the most 
part not needed. The models that did not have reasoning gave just as good of answers as the models that did. 
In past experiences, however, I have noticed that for more complex questions the models that did have reasoning were very 
good and much more equipt to answer the questions. This is especially true when the prompt includes coding. 

As far as coding goes, I took the script from the lecture, modified it to allow 
for model selection on gradio and also had it pip the prompt, output, usage and reasoning into a text file. 