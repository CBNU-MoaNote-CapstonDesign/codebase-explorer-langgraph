#include <string>

// 임의의 네임스페이스/구조체 예제 (저작권 문제 없는 토이 코드)
struct Account {
    int id;
    int sum(int a, int b) const;
};

// 클래스 외부 정의 (qualified name)
int Account::sum(int a, int b) const {
    return a + b;
}

// 네임스페이스 예시 (자유함수)
namespace Util {
    int to_value(bool include) { return include ? 1 : 0; }
}
