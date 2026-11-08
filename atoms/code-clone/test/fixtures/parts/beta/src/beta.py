import yaml


def read_config(location):
    """A renamed copy with other literals."""
    try:
        with open(location) as stream:
            return yaml.safe_load(stream)
    except OSError as error:
        raise KeyError(f"no {location}: {error}") from None


if __name__ == "__main__":
    print(read_config("beta.yaml"))
