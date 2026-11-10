Feature: A claim over the contracts of a background's steps

Scenario: A node the background places is below each node it places earlier

    A step that places a node states that the node is below its parent, and below is transitive.
    Each claim holds for every node the first step names.
    feature "nodes" entails "below(second, first)"
    feature "nodes" entails "below(second, top)"
