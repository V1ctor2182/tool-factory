import json


def total(values):
    return sum(value * 2 for value in values)


if __name__ == "__main__":
    print(json.dumps(total([1, 2])))
