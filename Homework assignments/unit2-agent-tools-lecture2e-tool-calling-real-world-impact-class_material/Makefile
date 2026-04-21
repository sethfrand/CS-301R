CXX = g++
CXXFLAGS = -std=c++17 -Wall -Wextra

all: lab

lab: main.cpp Scanner.cpp Token.cpp
	$(CXX) $(CXXFLAGS) -o lab main.cpp Scanner.cpp Token.cpp

clean:
	rm -f lab
