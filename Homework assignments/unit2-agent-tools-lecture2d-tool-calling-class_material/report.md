This assignment took longer than expected but was still really intersting. 
The web scraping part didin't take too long but it was a little buggy, the crawling 
to find the quotes took quite a bit longer and was really tricky. For the majority of my time, 
I was working on getting the crawler to actually crawl the website. I used the beautifulsoup library, 
and a library called Playwright for the crawling. I had to use this library because 
the churchs website was using javascript. I really liked the crawler because it 
didn't cost too much to run but it did late a long time to find the quote and most of the 
time is was a little off. The last run that I did I increased the amount of pages for it 
to crawl and increased the fuzzy search to try and get a better quote, it only slightly improved 
the quote. After reviewing the code, I had AI change it so that when the user queries a quote and identifies the 
speaker, the base url that is crawled includes the speaker so that only their talks are crawled. This 
worked significantly better and the quotes pulled were much more accurate. I just had to increase 
the threshold to .5 to get the better quotes.