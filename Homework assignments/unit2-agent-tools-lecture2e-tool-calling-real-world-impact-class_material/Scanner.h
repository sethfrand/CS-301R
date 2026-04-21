#ifndef SCANNER_H
#define SCANNER_H

#include "Token.h"
#include <string>

class Scanner {
public:
    explicit Scanner(const std::string& input);

    // Returns the next token; END when input is exhausted
    Token scanToken();

private:
    void skipWhitespace();
    char peek() const;
    bool isAtEnd() const;

    const std::string input;
    size_t pos;
    int line;
};

#endif // SCANNER_H
