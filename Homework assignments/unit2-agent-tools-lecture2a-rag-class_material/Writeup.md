This assignment was slightly less interesting to me than the others and so it was 
a bit more difficult to get in to. That being said, I can see the use cases for it and that makes me excited. 
While doing the assignment, I was thinking about how I could use this
in my own projects. It also helped me to better understand and how linear algebra 
in incorporated in LLMs and Machine Learning. I had looked into things such as cosine similarity in the 
past but had never really found way to use it or better understand it. 

For this assignment I used a webinterface that would allow me to upload documents 
or input text to change the chunking size, chunk overlap, and the number of chunks. The interface also had
a sematic search tab and a similarity search tab. I played around with checking the similarities 
between words in both English and Polish and also played around with sematic meaning in sentences. 
It was interesting to see that the similarity scores rarely got above 0.6 when using just 
single words. The similarity score got quite a bit 
higher when I tried sentences. One that I found especially interesting was that US only had a 
.5 score to United States. When I thought about it it did makes 
sense as US could be confused with "us". 

I also learned that this embedding process takes a very long time. 
I wanted to try embedding the entire standard works but it ended up taking so long that I 
decided to try just the Pearl of Great Price as that is the shortest work. Even that took a 
very long time with a rather large chunk size and small overlap. For the sematic search, 
the Pearl of Great Price took over 15 minutes to process. 