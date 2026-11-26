import type { Register } from 'claude-code'

const BG = '#3a342b'
const LINE = 'suggestion' // theme blue, bright in light and dark

export const register: Register = on => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const inner = await next(e)
    if (!inner) return inner
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" backgroundColor={BG}>
        <Text color={LINE}>{'━'.repeat(e.props.bodyColumns)}</Text>
        {inner}
      </Box>
    )
  })
}
