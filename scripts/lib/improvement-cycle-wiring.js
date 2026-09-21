'use strict';

function appendExpectationArtifactArgs(args, artifactPath) {
    return artifactPath ? [...args, '--expectations', artifactPath] : [...args];
}

module.exports = { appendExpectationArtifactArgs };
