<?php

// I tried decorating every "echo", but output buffering in PHP doesn't seem to allow that.
//
// useful resource on the subject:
// https://bugs.php.net/bug.php?id=23877
// https://www.php.net/manual/en/function.ob-implicit-flush.php
// https://stackoverflow.com/a/24108276/2788187
//
// So instead, just use a wrapper around echo.

/*
function mark($a) {
return "\n----- " . strlen($a) . " -----\n" . " " . $a;
}

function registerOutputBuffer() {
// ini_set('implicit_flush',1);
// ini_set('output_buffering', 0);
// while (ob_get_level()) {ob_end_flush();}
ob_implicit_flush();
ob_start('mark');
}

registerOutputBuffer();
 */

function json($val)
{
    return json_encode($val, JSON_PRETTY_PRINT);
}

class Marker
{
    private $frames = [];
    private $marks = [];
    private $output = '';

    public function mark(...$args)
    {
        $args = func_get_args();
        $output = join($args, ' ');

        $callStack = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS);
        // Remove `mark`.
        array_shift($callStack);
        // Remove `internal_print`.
        array_shift($callStack);
        // Add manual frames.
        $callStack = array_merge($callStack, $this->frameStack);

        $whitelist = ['file', 'line', 'function', 'class'];
        $callStack = array_map(function ($frame) use ($whitelist) {
            $filtered = array_intersect_key($frame, array_flip($whitelist));
            return $this->getFrameId($filtered);
        }, $callStack);

        $id = count($this->mappings);
        $this->mappings[] = [
            'source' => 'PHP',
            'callStack' => $callStack,
        ];
        $this->output = $this->output . $output;
        echo ('<!-- hm mapping: ' . $id . ' ' . json_encode(end($this->mappings)) . '-->');
        return [$output, $id];
    }

    public function markEnd($id)
    {
        echo ('<!-- hm mapping end: ' . $id . '-->');
    }

    public function &data()
    {
        return [
            'frames' => array_values($this->frames),
            'mappings' => $this->mappings,
            'output' => $this->output,
        ];
    }

    private $frameStack = [];
    public function pushFrame($frame)
    {
        $this->frameStack[] = $frame;
    }

    public function popFrame()
    {
        return array_pop($this->frameStack);
    }

    private function getFrameId($frame)
    {
        $key = $frame['file'] . $frame['line'];
        $index = array_search($key, array_keys($this->frames));
        if ($index != false) {
            return $index;
        }

        $id = count($this->frames);
        $this->frames[$key] = $frame;
        echo ('<!-- hm frame: ' . $id . ' ' . json_encode($frame) . '-->');
        return $id;
    }
}

class View
{
    public function __construct()
    {
        $this->marker = new Marker();
    }

    private function internal_print(...$args)
    {
        [$output, $id] = $this->marker->mark(...$args);
        echo ($output);
        $this->marker->markEnd($id);
    }

    function print(...$args) {
        // Ideally, all `internal_print` would be replaced with `echo`, but see file comment.
        $this->internal_print($str, ...$args);
    }

    public function sayHi()
    {
        $this->internal_print("<div>hello world</div>");
    }

    public function mingle(int $i)
    {
        $this->internal_print("blah blah " . $i);
    }

    public function sayBye()
    {
        $this->mingle(100);
        $this->internal_print("<div>goodbye world</div>");
    }

    public function sayCompliment()
    {
        $this->internal_print("you're beautiful");
    }
}

function getHeader()
{
    return 'HTML Source Map example';
}

$view = new View();
$view->print("<h1>", getHeader(), "</h1>");
$view->sayHi();
$view->print("<br>");
for ($i = 0; $i < 10; $i++) {
    $view->mingle($i);
    $view->print("<br>");
}
$view->sayBye();
$view->print("<br>");

// Using raw HTML is not supported directly.
// However, we can do an output buffering hack to get the output of this HTML as a string.
ob_start();
// Manually create a frame starting 2 lines ahead.
// Something like this would be done in an actual templating engine, marking a new frame for each template file loaded.
$view->marker->pushFrame(['file' => __FILE__, 'line' => __LINE__+2, 'class' => __CLASS__, 'function' => __FUNCTION__]);
?>

<!-- The pushFrame/popFrame calls will properly map this html. -->
<p>sup</p><br>

<!-- Nested renders work too, and will include the pushed frame in the callstack. -->
<p>hey there, <?=$view->sayCompliment()?>!</p>

<!-- Inject html-source-map code. -->
<script src="/js/html-source-maps.js"></script>
<script>
    window.__marks = HTMLSourceMap.collectFromPage();
    console.log(window.__marks);
    window.__marks.observe();
    window.__marks.debugRender();
</script>

<?php
$templateOutput = ob_get_clean();
[$content, $id] = $view->marker->mark(null, $templateOutput);
$view->marker->popFrame();
echo ($content);
$view->marker->markEnd($id);
?>
