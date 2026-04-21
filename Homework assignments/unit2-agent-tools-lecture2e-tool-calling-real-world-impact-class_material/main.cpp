#include "Scanner.h"
#include <iostream>
#include <string>

int main() {
    // Sample input to demonstrate tokenization (you can replace with file content)
    std::string input =
        "   ,  \"hello world\"  abc_123  , \"another string\" \n"
        "nextLineId";

    Scanner scanner(input);

    while (true) {
        Token t = scanner.scanToken();
        std::cout << t.toString() << std::endl;
        if (t.getType() == TokenType::END) break;
    }

    return 0;
}
