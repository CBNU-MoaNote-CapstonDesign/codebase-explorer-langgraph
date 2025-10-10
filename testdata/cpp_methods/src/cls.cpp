class A {
public:
    void m1(int x);
    void m2(int y) const;
};

void A::m1(int x) { (void)x; }
static int util() { return 42; }
