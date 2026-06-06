module.exports = {
    default: {
        paths: ['docs/business-requirements/**/*.feature'],
        requireModule: ['ts-node/register'],
        require: ['docs/business-requirements/steps/**/*.js'],
        format: ['progress'],
        publishQuiet: true,
    },
};
