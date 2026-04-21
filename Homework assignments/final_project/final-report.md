Problem to solve:

I am currently in the middile of amrathon training and wanting to get the most out of my training and 
train in the best way that I can. To do this, I want to be using the stats that are available to me, have them 
be presented in a way that is easy to visualize and understand. I also want to make sure that the shoes I am 
using are similar to shoes in the past that I have liked. To visualize all of my stats, there are a lot of options 
available, all of them however are subscription based and require a monthly fee to get the insights that 
I want. There is no where on the market that you can also quickly compare and contrast running shoes. 
That is the problem that I wanted to fix, I wanted to be able to see all of my stats in one place and 
also get shoes recommendations based on what I already have and what I want to do.

How the app works:

For a long time I knew about and would use a website called [RunRepeat](https://runrepeat.com/) to see how shoes 
compare to one another. This worked well for me but required me to have multiple tabs open and switch between them all, comparing 
the measurements and reviews for each shoe. Instead of doing that, I decided that I would have a webscrapper take the data and then 
I would save it to a vector database. An agent would have access to this data and would compare the shoes based on the query. In order for me 
to be able to compare it to the shoes that I already have, I connected the app to the Strava API that would pull the data from my strava
account that I have. The app also pulls data from [interval.icu](https://interval.icu/) to get the data from Garmin. Initially I wanted to 
pull the data from Garmin directly but I ran into a lot of issues with the API. I will explain more of that later. When the user 
has connected their strava account, the LLM can then see the data of the shoes and give recommendations based on what they have, the amount of miles that 
they have in each pair what they should buy as a replacement. When you ask for a shoes recommendation, it will also make a tool call to find 
where you can buy the shoes that it recommends so that you don't have to search for them. 
 
Specific agentic principles:

For this project I implemented tool calling to have the agent find the shoes that you want to buy and the shoes that it recommends. 
I also used a vector database to store data that has been scraped from the RunRepeat website so that the user can get specific stats
on the shoes that they have and the shoes that they want. I decided to do this so that the recommendations are 
more accurate and data driven instead of relying on the LLM to make the recommendations based off of the data that it was 
trained on. The vector database has more than 600 shoes in it. I also implemented a lot of prompt engineering to get the 
output to be what I wanted it to be. Quite a bit of the prompting was to get the output to be formatted and for it to 
not give too much information. I also wanted it to be able to interpret the data that was taken from intervals so that 
the user can get advice on recovery, interpreting their data and any other recommendations that they might want. 

Reflection:

The most difficult part of this project was actually working with the garmin API. At the beginning of my implementation it 
was hard to get the data that I wanted and then it worked for a little while, then it stopped working. For a while I thought 
that I had been making to many api calls while I was testing and that maybe I was blocked or even blacklisted. After doing a little bit of research, 
I learned that a lot of people are having issues with the API right now, I also learned that to really get the API working, you need to be part of their 
development program and that it takes a long time to get access to the API without being limited. I ended up finding a third party that 
already used the Garmin API to get data so I worked through that thrid party and got access to the API. The other part of this 
project that was difficult was getting the output from the chatbot to be formatted the way that I wanted it to be 
and to also not give too much information. It took a lot of prompt engineering to get it closer to what I want it to be. 
One thing that works really well with this project is that you can see all of your data and even have the agent analyze it
and give you recommendations. One thing that I would do differently would be to have more agents that are specialized for 
different types of queries. If I had more time, I wanted to have an agent that was specific to running shoes, another that 
was specific to analyzing the data and giving recommendations, and maybe even an agent that could help with training plans. Overall, I am really happy with how this project 
turned out and I think that it is something that I will continue to use as I train for my marathon.