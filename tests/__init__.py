import importlib.machinery

if "" not in importlib.machinery.SOURCE_SUFFIXES:
    importlib.machinery.SOURCE_SUFFIXES.insert(0, "")
